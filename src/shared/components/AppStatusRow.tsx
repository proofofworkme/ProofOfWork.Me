export type AppStatusTone = "idle" | "good" | "bad";

export type AppStatusState = {
  tone: AppStatusTone;
  text: string;
};

export function AppStatusRow({
  className = "",
  persistent = false,
  status,
}: {
  className?: string;
  persistent?: boolean;
  status: AppStatusState;
}) {
  if (!persistent && status.tone === "idle") {
    return null;
  }

  const statusClassName = ["status", "app-status-row", className, status.tone]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      aria-live={status.tone === "bad" ? "assertive" : "polite"}
      className={statusClassName}
      role={status.tone === "bad" ? "alert" : "status"}
    >
      <span className="status-dot" aria-hidden="true" />
      <span>{status.text}</span>
    </div>
  );
}
