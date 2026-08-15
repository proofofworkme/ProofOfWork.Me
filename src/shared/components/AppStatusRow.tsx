import type { ReactNode } from "react";

export type AppStatusTone = "idle" | "good" | "bad";

export type AppStatusLink = {
  ariaLabel?: string;
  href: string;
  text: string;
  title?: string;
};

export type AppStatusState = {
  links?: AppStatusLink[];
  tone: AppStatusTone;
  text: string;
};

function renderStatusText(status: AppStatusState) {
  const links = (status.links ?? []).filter(
    (link) => link.text.trim() && link.href.trim(),
  );
  if (links.length === 0) {
    return status.text;
  }

  const parts: ReactNode[] = [];
  const unmatchedLinks: AppStatusLink[] = [];
  let cursor = 0;
  links.forEach((link) => {
    const start = status.text.indexOf(link.text, cursor);
    if (start === -1) {
      unmatchedLinks.push(link);
      return;
    }

    if (start > cursor) {
      parts.push(status.text.slice(cursor, start));
    }

    parts.push(
      <a
        aria-label={link.ariaLabel}
        className="status-link"
        href={link.href}
        key={`${link.href}-${start}`}
        rel="noreferrer"
        target="_blank"
        title={link.title}
      >
        {link.text}
      </a>,
    );
    cursor = start + link.text.length;
  });

  if (cursor < status.text.length) {
    parts.push(status.text.slice(cursor));
  }

  unmatchedLinks.forEach((link) => {
    parts.push(" ");
    parts.push(
      <a
        aria-label={link.ariaLabel}
        className="status-link"
        href={link.href}
        key={`${link.href}-unmatched`}
        rel="noreferrer"
        target="_blank"
        title={link.title}
      >
        {link.text}
      </a>,
    );
  });

  return parts;
}

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
      <span className="status-text">{renderStatusText(lineStatus)}</span>
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
