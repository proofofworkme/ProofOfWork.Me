const WORKSPACE_OWNED_STATUS = new Set([
  "browser", "pages", "boost", "publish", "search", "code", "jobs", "permission",
]);

/** Presentation only: never changes stored status, read state, or wallet authority. */
export function computerShellStatus({ workspace, status, connected, secondaryStatus }) {
  const hasEvidenceLinks = Boolean(status.links?.length);
  const workspaceOwnsEntry = WORKSPACE_OWNED_STATUS.has(workspace) &&
    status.presentation === "entry" && status.tone === "idle" && !hasEvidenceLinks;
  const connectionInstructionResolved = connected &&
    status.presentation === "connection-required" && !hasEvidenceLinks;
  const primary = workspaceOwnsEntry || connectionInstructionResolved ? undefined : status;
  if (primary) return { primary, secondary: secondaryStatus };
  // A degraded read is never hidden with a redundant shell instruction.
  return secondaryStatus ? { primary: secondaryStatus } : undefined;
}
