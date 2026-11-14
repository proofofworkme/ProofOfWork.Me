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
