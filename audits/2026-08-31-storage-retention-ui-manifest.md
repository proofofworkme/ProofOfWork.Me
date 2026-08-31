# 2026-08-31 UI Storage-Retention Manifest

Scope: read-only manifest for `ubuntu-4gb-hel1-1`
(`root@77.42.91.106`). This file records candidate cleanup targets and proposed
next commands only. No production storage was deleted, no services were
restarted, no production configuration was changed, and no deployment occurred
during this phase.

## Health Snapshot

- Disk: `/` `38G` total, `14G` used, `23G` available, `37%` used.
- Inodes: `5%` used.
- Memory: `3.7Gi` total, `3.1Gi` available.
- Caddy: active.
- UI storage-health: passing.
- UI release provenance: verified.
- Active release id: `33c12c5a2a42-20260829T010316Z`.
- Active commit:
  `33c12c5a2a42a9afdd2d54195760f4f47fd1ca14`.
- Active archive:
  `proofofwork-ui-release-33c12c5a2a42-20260829T010316Z.tgz`.
- Active archive SHA256:
  `4bde499dc508db72ba5b2738a52eba819b5e6cc3375442413ac10d7928bb53de`.

Public page checks from the UI VPS:

| Host | Status |
| --- | --- |
| `proofofwork.me` | `301` redirect |
| `id.proofofwork.me` | `200` |
| `desktop.proofofwork.me` | `200` |
| `browser.proofofwork.me` | `200` |
| `amo.proofofwork.me` | `200` |
| `credit.proofofwork.me` | `200` |
| `wallet.proofofwork.me` | `200` |
| `work.proofofwork.me` | `200` |
| `infinity.proofofwork.me` | `200` |
| `inception.proofofwork.me` | `200` |
| `log.proofofwork.me` | `200` |
| `growth.proofofwork.me` | `200` |
| `computer.proofofwork.me` | `200` |

## Storage Summary

- `/var/tmp/proofofwork-deploy`: `4.1G`.
- `/var/backups/proofofwork-ui`: `5.2G`.
- `/var/www`: `386M`.
- `/var/log`: `574M`.
- `/var/log/caddy`: about `13M`; no warning-or-higher Caddy journal entries
  in the last 24h.

## UI Deploy Scratch Candidates

`/var/tmp/proofofwork-deploy` contains old deployment source trees, built
surface directories, tarballs, and small staging leftovers. The currently
installed `proofofwork-ui-storage-prune` job reports `candidate_paths=0` because
these paths are not marked by its rebuildable-stage marker. This makes the
directory a good phase 2 cleanup candidate, but it should be cleaned by exact
path approval or by a code/config update that marks deploy scratch safely.

Largest exact candidates:

| Size | Path |
| ---: | --- |
| `216M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-052d54433e9f-20260828T020349Z` |
| `216M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-33c12c5a2a42-20260829T010316Z` |
| `216M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-46997070c645-20260829T002726Z` |
| `216M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-6ff2fa144acb-20260827T231524Z` |
| `216M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-cdc8f77853d7-20260828T024753Z` |
| `216M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-f72625efe28a-20260829T000704Z` |
| `187M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-33c12c5a2a42-20260829T010316Z` |
| `187M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-46997070c645-20260829T002726Z` |
| `187M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-f72625efe28a-20260829T000704Z` |
| `174M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-052d54433e9f-20260828T020349Z` |
| `174M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-6ff2fa144acb-20260827T231524Z` |
| `174M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-cdc8f77853d7-20260828T024753Z` |
| `168M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-14bdd833038d-20260829T001819Z.tgz` |
| `168M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-33c12c5a2a42-20260829T010316Z.tgz` |
| `168M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-46997070c645-20260829T002726Z.tgz` |
| `168M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-f72625efe28a-20260829T000704Z.tgz` |
| `157M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-052d54433e9f-20260828T020349Z.tgz` |
| `157M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-6ff2fa144acb-20260827T231524Z.tgz` |
| `157M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-cdc8f77853d7-20260828T024753Z.tgz` |
| `78M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-052d54433e9f-20260828T020349Z.tgz` |
| `78M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-14bdd833038d-20260829T001819Z.tgz` |
| `78M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-33c12c5a2a42-20260829T010316Z.tgz` |
| `78M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-46997070c645-20260829T002726Z.tgz` |
| `78M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-6ff2fa144acb-20260827T231524Z.tgz` |
| `78M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-cdc8f77853d7-20260828T024753Z.tgz` |
| `78M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-f72625efe28a-20260829T000704Z.tgz` |
| `28M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-339e328-20260818T032356Z` |
| `28M` | `/var/tmp/proofofwork-deploy/proofofwork-ui-source-786a555-20260818T030915Z` |

Small exact leftovers also exist under the same directory, including old
`ui-*`, `ui-release-*-extract`, `proofofwork-ui-stage-*`, helper scripts, and
matching `.sha256` files. They are low value individually but should be included
in any approved full cleanup of `/var/tmp/proofofwork-deploy`.

Proposed phase 2 command form:

```bash
ssh root@77.42.91.106 'find /var/tmp/proofofwork-deploy -mindepth 1 -maxdepth 1 -print | sort'
```

Actual deletion should be exact-path, or an approved update to the storage-prune
script should mark these as rebuildable deploy scratch and prune them safely.

## UI Release Backups

Installed release prune unit:

- `proofofwork-ui-release-prune.service` runs
  `/usr/local/sbin/proofofwork-release-prune /var/backups/proofofwork-ui/releases 5`.
- Timer is active and runs daily.
- Latest service run succeeded on `2026-08-31T00:10:15Z`.

Release backup inventory:

| Size | Path | Phase 2 Classification |
| ---: | --- | --- |
| `171M` | `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-33c12c5a2a42-20260829T010316Z.tgz` | Protect active release archive |
| `159M` | `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-e70f227095ea-20260827T134325Z.tgz` | Retain unless policy chooses older-than-5 cleanup |
| `159M` | `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-6ff2fa144acb-20260827T231524Z.tgz` | Retain unless policy chooses older-than-5 cleanup |
| `157M` | `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-cdc8f77853d7-20260828T024753Z.tgz` | Retain unless policy chooses older-than-5 cleanup |
| `157M` | `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-052d54433e9f-20260828T020349Z.tgz` | Retain unless policy chooses older-than-5 cleanup |
| `157M` | `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-cbb0de3-20260824T013448Z.tgz.pre-normalized-20260824T020000Z` | Candidate after provenance decision |
| `157M` | `/var/backups/proofofwork-ui/releases/proofofwork-ui-pre-amo-v5-20260726T200700Z.tgz` | Protect unless AMO V5 historical evidence can be archived elsewhere |
| `146M` | `/var/backups/proofofwork-ui/releases/proofofwork-ui-pre-mail-work-admission-27a3c25.tgz` | Protect unless mail/work admission evidence can be archived elsewhere |
| `145M` | `/var/backups/proofofwork-ui/releases/20260716T201653Z-pre-0e48e49` | Candidate after July evidence decision |
| `134M` | `/var/backups/proofofwork-ui/releases/ui-pre-work-atoms-20260716T185321Z.tgz` | Protect unless work-atoms evidence can be archived elsewhere |

## UI Rollback Backups

Rollback inventory:

| Size | Path | Phase 2 Classification |
| ---: | --- | --- |
| `370M` | `/var/backups/proofofwork-ui/rollbacks/proofofwork-www-pre-052d54433e9f-20260828T020349Z` | Candidate after release coverage check |
| `369M` | `/var/backups/proofofwork-ui/rollbacks/proofofwork-www-pre-6ff2fa144acb-20260827T231524Z` | Candidate after release coverage check |
| `360M` | `/var/backups/proofofwork-ui/rollbacks/proofofwork-www-pre-cdc8f77853d7-20260828T024753Z` | Candidate after release coverage check |
| `360M` | `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-33c12c5a2a42-20260829T010316Z` | Protect as active rollback root unless replacement exists |
| `359M` | `/var/backups/proofofwork-ui/rollbacks/proofofwork-www-pre-e70f227095ea-20260827T134325Z` | Candidate after release coverage check |
| `340M` | `/var/backups/proofofwork-ui/rollbacks/c8735e9-20260803T232500Z` | Candidate after August rollback evidence decision |
| `339M` | `/var/backups/proofofwork-ui/rollbacks/c8735e9-20260804T014500Z` | Candidate after August rollback evidence decision |
| `157M` | `/var/backups/proofofwork-ui/rollbacks/c8735e9-20260803T232000Z` | Candidate after August rollback evidence decision |
| `157M` | `/var/backups/proofofwork-ui/rollbacks/c8735e9-20260803T203911Z` | Candidate after August rollback evidence decision |
| `157M` | `/var/backups/proofofwork-ui/rollbacks/5886608-20260818T175958Z` | Candidate after August rollback evidence decision |
| `157M` | `/var/backups/proofofwork-ui/rollbacks/345f7eb-20260803T034328Z` | Candidate after August rollback evidence decision |

## UI Web-Root Non-Live Backups

These are small compared with backup/deploy scratch pressure. They are not live
surfaces, but they should stay protected until their release archives and
rollback roots are verified.

| Size | Path |
| ---: | --- |
| `13M` | `/var/www/proofofwork-activity.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-activity.previous-c9f486e-20260824T004631Z` |
| `13M` | `/var/www/proofofwork-browser.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-computer.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-desktop.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-growth.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-id.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-inception.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-infinity.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-landing.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-marketplace.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-nft.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-token.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-wallet.pre-rollback-current-20260825T134644Z` |
| `13M` | `/var/www/proofofwork-work.pre-rollback-current-20260825T134644Z` |
| `60K` | `/var/www/.release-c9eb357` |

## Proxy/API Pressure Observations

The UI host is not the source of the recent API errors. Caddy journal warnings
were empty, public pages were reachable, and static storage was healthy.
Access-log 502/503 entries were concentrated on proxied backend API routes,
especially:

- `computer.proofofwork.me /api/v1/health`
- `amo.proofofwork.me /api/v1/marketplace-summary`
- `wallet.proofofwork.me /api/v1/token`
- `wallet.proofofwork.me /api/v1/work-floor`

Current public route checks returned `200`, but payload size is large:

- `wallet.proofofwork.me/api/v1/token`: `60.8MB` without gzip,
  `2.7MB` with gzip.
- `amo.proofofwork.me/api/v1/marketplace-summary`: `15.8MB` without gzip,
  `1.0MB` with gzip.
- `amo.proofofwork.me/api/v1/registry`: `2.2MB` without gzip,
  `216KB` with gzip.

Proposed phase 2 UI/API performance actions:

1. Keep compression enabled and verify browsers receive compressed JSON.
2. Add smaller first-paint endpoints or query parameters for Wallet token and
   AMO summary views.
3. Add Caddy/API status dashboards that separate backend fail-closed states
   from UI/static serving health.
4. Install or vendor an approved JSON log summarizer on the UI VPS, or make the
   Caddy log health script not depend on `jq`.
