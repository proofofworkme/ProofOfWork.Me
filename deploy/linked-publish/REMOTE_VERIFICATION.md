# Stock writer-off release verification

Run the stock release-sync gate from the clean primary `main` checkout on the
connected computer, after GitHub, local preview, production UI and renderer
match the candidate. The node build source must be the exact same committed
source and tree:

```sh
POW_PUBLISH_CHECK_MODE=preactivation \
POW_PUBLISH_CHECK_NODE_SOURCE=/data/proofofwork-ui-builds/BUILD/proofofwork-ui-source-COMMIT12-TIMESTAMP \
npm run check:release-sync
```

Replace the build path with the canonical `sourceCheckout` from that build's
receipt. Do not set `POW_INTERNAL_VERIFIER_TOKEN` or
`POW_PUBLISH_CHECK_ORIGIN` locally. They are not needed and are refused in remote
mode. The existing node identity invokes a bounded transient service which
inherits the protected node verifier environment. No token is read by the
orchestrator, copied to the connected computer, or placed in a command line or
verification output. No application or protocol data is written.

The first combined-live child runs the unchanged Publish checker against node
loopback in preactivation mode. Local and remote commit/tree/cleanliness,
dependency-free four-code-file checker import closure, package manifest/lockfile and the node build receipt
are checked before execution; source is fenced again afterward. The three metadata
functions are imported directly from their canonical defining module instead of
the identical re-export through a module that imports Bitcoin signing packages.
All capability/article assertions are unchanged. No node_modules code executes
in the protected probe. NODE_OPTIONS and NODE_PATH are unset in the transient
service to prevent executable preloads. Cleanliness includes untracked files;
source ancestors/files must belong to root or the established powadmin account
and must not be group/world writable.
`GIT_OPTIONAL_LOCKS=0` prevents optional Git index writes. The probe has a
300-second service limit, 330-second remote launcher limit and 360-second SSH
limit. It must prove terminal process/cgroup state. A transport timeout or
unverified terminal outcome fails closed and names its unique unit; reconcile
that unit before retrying. There is no automatic retry.

The JSON output includes the unchanged checker's exact `rawResult` string and
its SHA-256, source/build pins, unit and verified terminal state. Preserve the
exact UTF-8 bytes of `rawResult` as the preactivation artifact for retained
rollback validation; do not reserialize it or substitute an earlier result.
This verifies disabled-writer readiness and existing articles only. It does
not claim a new signed publication.

The original public Growth and activity/fee checks run next on the connected
computer, with all private/remote preactivation settings removed. Their
arithmetic, stable-tip, monitor and retention checks remain mandatory. With no
preactivation mode set, the original active/public Publish check is unchanged.
