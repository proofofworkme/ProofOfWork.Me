# Historical policy test fixture

`prior-ui-release-policy-e99e149.py` is the exact 49,809-byte
`deploy/audit30/ui-release-policy.py` blob from commit
`e99e149c41e1173fa8677b55e1c5ccffe21df99e`.
SHA-256: `d6e3239ea3401c02461aa3e05bcf07cbb4eba1a18763fcb14d8a54264316dd4d`.

The preservation migration integration test executes these hash-verified bytes
only against synthetic temporary state with its fixture storage module bound.
It exercises the real preceding policy, not a simplified mock. Keeping the
fixture committed makes CI independent of unpublished/rebased Git objects and
checkout depth. This is test evidence, not a deployable controller or backup.
Do not regenerate it from the current policy or silently change its digest.

The separate retirement package-upgrade fixtures preserve the original terminal
receipt, journal, index and `payloadRetirement.policyCodeSha256`. A later package
uses an authenticated `payloadRetirementSourceConfig` anchor and a bounded,
sealed config-upgrade chain; its current package hash is a separate identity.
`check-retirement-package-upgrade.test.py` covers altered anchors and edges,
missing seals, and upgrades across later ordinary cycles. The stock authority
integration fixture also executes the real installer and normal successor status
inside its explicit synthetic namespace. Its original and successor packages
both use the tested validator code, so that fixture does not substitute for a
read-only verification of the actual installed predecessor before deployment.
