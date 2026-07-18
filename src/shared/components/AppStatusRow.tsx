export type AppStatusTone = "idle" | "good" | "bad";

export type AppStatusState = {
  tone: AppStatusTone;
  text: string;
};

export function AppStatusRow({
  className = "",
  persistent = false,
  secondaryStatus,
  status,
}: {
  className?: string;
  persistent?: boolean;
  secondaryStatus?: AppStatusState;
  status: AppStatusState;
}) {
  const showPrimary = persistent || status.tone !== "idle";
  const showSecondary = Boolean(secondaryStatus?.text.trim());
  if (!showPrimary && !showSecondary) {
    return null;
  }

  const statusLine = (
    lineStatus: AppStatusState,
    lineClassName = "",
  ) => (
    <div
      aria-live={lineStatus.tone === "bad" ? "assertive" : "polite"}
      className={["status", lineClassName, lineStatus.tone]
        .filter(Boolean)
        .join(" ")}
      role={lineStatus.tone === "bad" ? "alert" : "status"}
    >
      <span className="status-dot" aria-hidden="true" />
      <span>{lineStatus.text}</span>
    </div>
  );

  if (showSecondary && secondaryStatus) {
    return (
      <div
        className={["app-status-row", "app-status-stack", className]
          .filter(Boolean)
          .join(" ")}
      >
        {showPrimary ? statusLine(status, "app-status-primary") : null}
        {statusLine(secondaryStatus, "app-status-degraded")}
      </div>
    );
  }

  return statusLine(
    status,
    ["app-status-row", className].filter(Boolean).join(" "),
  );
}
